'use strict';

// Finishing the encryption of a wave's older pings (v2.143.1).
//
// A wave that was plain and then encrypted keeps state 2 until every older
// ping is encrypted. Two things kept such waves at 2 for good:
//
// - the wave as served says only `encrypted: true`, so the app could not tell
//   2 from 1 and never offered to finish (GET /api/waves/:id now carries
//   `encryptionState`);
// - progress was "all pings minus encrypted ones", which also counted pings
//   the migration is never handed (expired ones, kept as erased rows), so the
//   last batch could never complete it. `remaining` now counts exactly what
//   /unencrypted-pings hands out.
//
// The counterfactual takes the second fix out of a copy of the server and
// sees the wave stay at 2 after every ping it was given is encrypted.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const serverRequire = createRequire(path.join(root, 'server/package.json'));

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

function editFile(dir, file, pairs) {
  const p = path.join(dir, file);
  let src = fs.readFileSync(p, 'utf8');
  for (const [from, to] of pairs) {
    assert.ok(src.includes(from), `could not find: ${from.slice(0, 80)}`);
    src = src.split(from).join(to);
  }
  fs.writeFileSync(p, src);
}

// The counting fix, taken out (the counterfactual).
function withoutFix(dir) {
  editFile(dir, 'server.js', [
    ['    if (updatedStatus.remaining === 0) {', '    if (updatedStatus.encryptedPings === updatedStatus.totalPings) {'],
  ]);
}

const b64 = (n) => crypto.randomBytes(n).toString('base64');

async function scenario({ fixed }) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-e2ee-mig-'));
  const password = 'MigrateNow123!';
  let child;
  try {
    const serverDir = copyServer(temp, fixed ? null : withoutFix);
    fs.appendFileSync(path.join(serverDir, 'server.js'),
      "\nserver.on('listening', () => console.log('E2EE_MIG_PORT=' + server.address().port));\n");
    let output = '';
    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-e2ee-migration-0000000',
        SEED_DEMO_DATA: 'false',
        RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000', RATE_LIMIT_REGISTER_MAX: '10000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    const deadline = Date.now() + 25000;
    while (!/E2EE_MIG_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-3000));
      await new Promise(r => setTimeout(r, 50));
    }
    const base = `http://127.0.0.1:${output.match(/E2EE_MIG_PORT=(\d+)/)[1]}`;
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
      assert.equal(login.status, 200, JSON.stringify(login.body));
      const user = { token: login.body.token, id: login.body.user.id, publicKey: b64(120) };
      const reg = await api('POST', '/api/e2ee/keys/register', { token: user.token, body: { publicKey: user.publicKey, encryptedPrivateKey: b64(200), salt: b64(16) } });
      assert.ok(reg.status < 300, JSON.stringify(reg.body));
      return user;
    };
    const Database = serverRequire('better-sqlite3');
    const raw = (fn) => { const d = new Database(path.join(serverDir, 'data/farhold.db')); try { return fn(d); } finally { d.close(); } };

    await makeUser('nodeadmin');
    const owner = await makeUser('mowner');
    const member = await makeUser('mmember');

    // A plain wave with four pings, one of which has since expired.
    const created = await api('POST', '/api/waves', { token: owner.token, body: { title: 'Plain first', privacy: 'private', participants: [member.id] } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const waveId = created.body.id;
    for (const i of ((await api('GET', '/api/wave-invitations', { token: member.token })).body?.invitations || [])) {
      await api('POST', `/api/wave-invitations/${i.id}/accept`, { token: member.token });
    }
    const ids = [];
    for (const text of ['one', 'two', 'three', 'gone soon']) {
      const r = await api('POST', '/api/pings', { token: owner.token, body: { wave_id: waveId, content: text } });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      ids.push(r.body.id);
    }
    raw(d => d.prepare('UPDATE pings SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 60000).toISOString(), ids[3]));

    const result = {};
    const wave = async (user) => (await api('GET', `/api/waves/${waveId}`, { token: user.token })).body;
    result.plainState = (await wave(member)).encryptionState;

    // Encryption enabled: state 2 until the older pings are done.
    const enable = await api('POST', `/api/waves/${waveId}/encrypt`, {
      token: owner.token,
      body: { keyDistribution: [owner, member].map(p => ({ userId: p.id, encryptedWaveKey: `${b64(48)}:${b64(12)}`, senderPublicKey: owner.publicKey })) },
    });
    assert.ok(enable.status < 300, JSON.stringify(enable.body));
    const during = await wave(member);
    result.during = { encrypted: during.encrypted, state: during.encryptionState };
    const status = (await api('GET', `/api/waves/${waveId}/encryption-status`, { token: member.token })).body;
    result.statusRemaining = status.remaining;

    // The owner encrypts every ping they are handed, in one batch.
    const handed = (await api('GET', `/api/waves/${waveId}/unencrypted-pings?limit=50`, { token: owner.token })).body.pings;
    result.handed = handed.length;
    const done = await api('POST', `/api/waves/${waveId}/encrypt-pings`, {
      token: owner.token, body: { pings: handed.map(p => ({ id: p.id, content: b64(48), nonce: b64(12) })) },
    });
    result.batch = { remaining: done.body.remaining, hasMore: done.body.hasMore, state: done.body.encryptionState };
    result.after = (await wave(member)).encryptionState;
    return result;
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise(r => { child.once('exit', r); setTimeout(r, 3000); });
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

test('a wave encrypting its older pings says so, and finishes when they are done', { timeout: 90000 }, async () => {
  const r = await scenario({ fixed: true });
  assert.equal(r.plainState, 0);
  assert.deepEqual(r.during, { encrypted: true, state: 2 }, 'state 2 is encrypted, and told apart from 1');
  assert.equal(r.statusRemaining, 3, 'the expired ping is not counted');
  assert.equal(r.handed, 3);
  assert.deepEqual(r.batch, { remaining: 0, hasMore: false, state: 1 });
  assert.equal(r.after, 1);
});

test('counterfactual: counting all pings, the wave never finishes', { timeout: 90000 }, async () => {
  const r = await scenario({ fixed: false });
  assert.equal(r.handed, 3);
  assert.equal(r.batch.state, 2, 'every ping it was handed is encrypted, and it is still part-way');
  assert.equal(r.after, 2);
});
