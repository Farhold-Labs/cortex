'use strict';

// Per-wave roles (v2.88.0).
//
// This is authorization code: the interesting assertions are the ones that must
// FAIL. The feature exists so an announcement wave can be delegated without
// granting instance-wide moderator, so the test that matters most is that an
// ordinary member still cannot post, and that appointing is itself privileged.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const serverRequire = createRequire(path.join(root, 'server/package.json'));

test('wave roles gate announcement posting without instance-wide moderator', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-roles-'));
  const password = 'WaveRoles123!';
  const jwtSecret = 'test-secret-for-wave-roles-only-000000000000';
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

    const { DatabaseSQLite } = await import('../server/database-sqlite.js');
    const db = new DatabaseSQLite({ dbPath: path.join(serverDir, 'data/farhold.db') });
    const hash = serverRequire('bcryptjs').hashSync(password, 4);
    // 'stranger' is never appointed to anything — 'outsider' gets appointed mid-test,
    // and appointing joins them to the wave, so they stop being a valid negative.
    const users = ['owner', 'deputy', 'member', 'crewmod', 'outsider', 'stranger'];
    for (const id of users) {
      db.createUser({ id, handle: id, email: `${id}@example.test`, passwordHash: hash, displayName: id });
    }

    // An announcement wave: readable by its participants, writable by staff only.
    const wave = db.createWave({ title: 'Announcements', createdBy: 'owner', participants: ['deputy', 'member'] });
    db.updateWaveAnnouncementSettings(wave.id, { postPolicy: 'staff' });

    // A crew-owned announcement wave, to exercise inheritance.
    const crew = db.createGroup({ name: 'Cast', createdBy: 'owner' });
    db.addGroupMember(crew.id, 'crewmod', 'moderator');
    db.addGroupMember(crew.id, 'member', 'member');
    const crewWave = db.createWave({ title: 'Cast notices', createdBy: 'owner', groupId: crew.id, privacy: 'group' });
    db.updateWaveAnnouncementSettings(crewWave.id, { postPolicy: 'staff' });
    db.db.close();

    fs.appendFileSync(
      path.join(serverDir, 'server.js'),
      "\nserver.on('listening', () => console.log('ROLES_TEST_PORT=' + server.address().port));\n"
    );

    let output = '';
    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: jwtSecret, FEDERATION_ENABLED: 'false',
        SEED_DEMO_DATA: 'false', RATE_LIMIT_API_MAX: '10000', RATE_LIMIT_LOGIN_MAX: '100',
        // Exercise the encrypted path, not the plaintext fallback.
        WAVE_PARTICIPATION_KEY: 'a'.repeat(64),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });

    const deadline = Date.now() + 20000;
    while (!/ROLES_TEST_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) {
        throw new Error('Cortex startup failed: ' + output.slice(-4000));
      }
      await new Promise(r => setTimeout(r, 50));
    }
    const base = `http://127.0.0.1:${output.match(/ROLES_TEST_PORT=(\d+)/)[1]}`;

    const tokens = {};
    const req = (url, who, options = {}) => fetch(base + url, {
      ...options,
      headers: {
        ...(tokens[who] ? { Authorization: `Bearer ${tokens[who]}` } : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    for (const who of users) {
      const res = await fetch(base + '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: who, password }),
      });
      const data = await res.json();
      assert.equal(res.status, 200, JSON.stringify(data));
      tokens[who] = data.token;
    }

    const post = (waveId, who, content = 'hello') =>
      req('/api/pings', who, { method: 'POST', body: { wave_id: waveId, content } });
    const setRole = (waveId, target, role, who) =>
      req(`/api/waves/${waveId}/roles/${target}`, who, { method: 'PUT', body: { role } });

    await t.test('an announcement wave starts closed to everyone but its owner', async () => {
      assert.equal((await post(wave.id, 'owner')).status, 201);
      assert.equal((await post(wave.id, 'member')).status, 403);
      assert.equal((await post(wave.id, 'deputy')).status, 403);
    });

    await t.test('an ordinary member cannot appoint themselves', async () => {
      assert.equal((await setRole(wave.id, 'member', 'moderator', 'member')).status, 403);
      assert.equal((await post(wave.id, 'member')).status, 403);
    });

    await t.test('an appointed moderator can post, without any instance role', async () => {
      assert.equal((await setRole(wave.id, 'deputy', 'moderator', 'owner')).status, 200);
      assert.equal((await post(wave.id, 'deputy')).status, 201);
      // and gained nothing anywhere else
      assert.equal((await post(crewWave.id, 'deputy')).status, 403);
    });

    await t.test('a wave admin may appoint moderators but not other admins', async () => {
      assert.equal((await setRole(wave.id, 'member', 'admin', 'owner')).status, 200);
      assert.equal((await setRole(wave.id, 'outsider', 'moderator', 'member')).status, 200);
      assert.equal((await setRole(wave.id, 'outsider', 'admin', 'member')).status, 403);
    });

    await t.test('the owner cannot be demoted or removed', async () => {
      assert.equal((await setRole(wave.id, 'owner', 'moderator', 'owner')).status, 400);
      assert.equal((await req(`/api/waves/${wave.id}/roles/owner`, 'owner', { method: 'DELETE' })).status, 400);
    });

    await t.test('crew staff inherit standing in that crew\'s waves', async () => {
      assert.equal((await post(crewWave.id, 'crewmod')).status, 201);
      assert.equal((await post(crewWave.id, 'member')).status, 403);
    });

    await t.test('inherited standing cannot be removed from the wave', async () => {
      const res = await req(`/api/waves/${crewWave.id}/roles/crewmod`, 'owner', { method: 'DELETE' });
      assert.equal(res.status, 409);
      assert.equal((await res.json()).source, 'crew');
    });

    await t.test('removing a role revokes posting again', async () => {
      assert.equal((await req(`/api/waves/${wave.id}/roles/deputy`, 'owner', { method: 'DELETE' })).status, 200);
      assert.equal((await post(wave.id, 'deputy')).status, 403);
    });

    await t.test('roles are listed with their source', async () => {
      const res = await req(`/api/waves/${crewWave.id}/roles`, 'owner');
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.yourRole, 'owner');
      const byId = Object.fromEntries(body.staff.map(s => [s.userId, s]));
      assert.equal(byId.owner.role, 'owner');
      assert.equal(byId.crewmod.source, 'crew');
      assert.equal(byId.crewmod.role, 'moderator');
    });

    await t.test('someone with no access to the wave cannot read its staff list', async () => {
      assert.equal((await req(`/api/waves/${wave.id}/roles`, 'stranger')).status, 403);
      assert.equal((await post(wave.id, 'stranger')).status, 403);
    });

    await t.test('roles are not stored in the clear', async () => {
      const raw = fs.readFileSync(path.join(serverDir, 'data/farhold.db'));
      // The blob is AES-GCM; the plain string "moderator" adjacent to a user id
      // would mean the social graph is sitting in the dump after all.
      const dump = raw.toString('latin1');
      const rolesTable = dump.indexOf('wave_roles_encrypted');
      assert.ok(rolesTable > -1, 'expected the table to exist');
      assert.ok(!/\{"deputy":"moderator"/.test(dump), 'role map found in plaintext');
    });
  } finally {
    if (child) child.kill('SIGKILL');
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
