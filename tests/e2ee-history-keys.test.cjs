'use strict';

// A newcomer reads an encrypted wave's history (v2.145.4).
//
// Each ping records the version of the wave's key it was sealed with, and the
// key gets a new version whenever it is renewed (since v2.143.0, every time
// someone leaves). Someone added later was only ever given the current
// version, so every ping from before they joined showed "decryption failed",
// and renewing the key only made another version. Now a key request names
// every version they lack and a member's device wraps each one it holds. The
// server stores a version only if the giver holds it, never over a key the
// person already has, and only for someone still in the wave.
//
// Counterfactual: with the old request rule (any key at all ends it), the
// newcomer cannot even ask.
// in e2ee-key-records.test.cjs and checked in a browser.

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

// The old request rule: having any key at all ended it.
function oldRequestRule(dir) {
  editFile(dir, 'server.js', [
    ['    const missing = db.missingWaveKeyVersions(waveId, requesterId);\n    if (missing.length === 0) {',
     '    const missing = db.missingWaveKeyVersions(waveId, requesterId);\n    if (db.getWaveKeyForUser(waveId, requesterId)) {'],
  ]);
}

const b64 = (n) => crypto.randomBytes(n).toString('base64');

async function scenario({ fixed }) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-e2ee-hist-'));
  const password = 'History123!';
  let child;
  try {
    const serverDir = copyServer(temp, fixed ? null : oldRequestRule);
    fs.appendFileSync(path.join(serverDir, 'server.js'),
      "\nserver.on('listening', () => console.log('E2EE_HIST_PORT=' + server.address().port));\n");
    let output = '';
    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-e2ee-history-0000000000',
        SEED_DEMO_DATA: 'false',
        RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000', RATE_LIMIT_REGISTER_MAX: '10000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    const deadline = Date.now() + 25000;
    while (!/E2EE_HIST_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-3000));
      await new Promise(r => setTimeout(r, 50));
    }
    const base = `http://127.0.0.1:${output.match(/E2EE_HIST_PORT=(\d+)/)[1]}`;
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
      const user = { handle, token: login.body.token, id: login.body.user.id, publicKey: b64(120) };
      const reg = await api('POST', '/api/e2ee/keys/register', { token: user.token, body: { publicKey: user.publicKey, encryptedPrivateKey: b64(200), salt: b64(16) } });
      assert.ok(reg.status < 300, JSON.stringify(reg.body));
      return user;
    };
    const acceptAll = async (user) => {
      for (const i of ((await api('GET', '/api/wave-invitations', { token: user.token })).body?.invitations || [])) {
        await api('POST', `/api/wave-invitations/${i.id}/accept`, { token: user.token });
      }
    };
    const wrapped = () => `${b64(48)}:${b64(12)}`;
    const keyFor = (from, to) => ({ userId: to.id === from.id ? null : to.id, encryptedWaveKey: wrapped(), senderPublicKey: from.publicKey });
    const Database = serverRequire('better-sqlite3');
    const held = (userId) => {
      const d = new Database(path.join(serverDir, 'data/farhold.db'));
      try { return d.prepare('SELECT key_version v, encrypted_wave_key k FROM wave_encryption_keys WHERE wave_id = ? AND user_id = ? ORDER BY key_version').all(waveId, userId); }
      finally { d.close(); }
    };

    await makeUser('nodeadmin');
    const owner = await makeUser('howner');
    const member = await makeUser('hmember');
    const newcomer = await makeUser('hnew');
    const outsider = await makeUser('hout');

    // An encrypted wave on version 1, then renewed: version 2.
    const created = await api('POST', '/api/waves', {
      token: owner.token,
      body: { title: 'Sealed', privacy: 'private', participants: [member.id], encrypted: true, keyDistribution: [owner, member].map(p => keyFor(owner, p)) },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    var waveId = created.body.id;
    await acceptAll(member);
    const rot = await api('POST', `/api/waves/${waveId}/key/rotate`, { token: owner.token, body: { keyDistribution: [owner, member].map(p => keyFor(owner, p)) } });
    assert.equal(rot.status, 200, JSON.stringify(rot.body));

    // The newcomer joins and is given the current key, as the app does.
    const added = await api('POST', `/api/waves/${waveId}/participants`, { token: owner.token, body: { userId: newcomer.id } });
    assert.ok(added.status < 300, JSON.stringify(added.body));
    await acceptAll(newcomer);
    const dist = await api('POST', `/api/waves/${waveId}/key/distribute`, { token: member.token, body: { userId: newcomer.id, encryptedWaveKey: wrapped(), senderPublicKey: member.publicKey } });
    assert.equal(dist.status, 200, JSON.stringify(dist.body));

    const r = {};
    r.newcomerBefore = held(newcomer.id).map(k => k.v);
    const asked = await api('POST', `/api/waves/${waveId}/key-request`, { token: newcomer.token });
    r.ask = { status: asked.status, versions: asked.body?.versions };
    r.outsiderAsks = (await api('POST', `/api/waves/${waveId}/key-request`, { token: outsider.token })).status;
    if (asked.status === 200) {
      const requestId = asked.body.requestId;
      const v2Before = held(newcomer.id).find(k => k.v === 2)?.k;
      // Wrapped with a key that isn't the giver's own: refused.
      r.wrongSender = (await api('POST', `/api/waves/${waveId}/key-grant`, {
        token: owner.token, body: { requestId, senderPublicKey: b64(120), keys: [{ keyVersion: 1, encryptedWaveKey: wrapped() }] },
      })).body?.code;
      // Version 1, plus a different version 2 (must not replace theirs) and a
      // version nobody holds (must be ignored).
      const grant = await api('POST', `/api/waves/${waveId}/key-grant`, {
        token: member.token,
        body: { requestId, senderPublicKey: member.publicKey, keys: [1, 2, 7].map(keyVersion => ({ keyVersion, encryptedWaveKey: wrapped() })) },
      });
      r.grant = { status: grant.status, stored: grant.body?.stored };
      r.newcomerAfter = held(newcomer.id).map(k => k.v);
      r.v2Kept = held(newcomer.id).find(k => k.v === 2)?.k === v2Before;
      r.askAgain = (await api('POST', `/api/waves/${waveId}/key-request`, { token: newcomer.token })).status;
      r.allKeys = (await api('GET', `/api/waves/${waveId}/keys/all`, { token: newcomer.token })).body?.keys?.map(k => k.keyVersion);

      // A request outlives a removal: a grant for someone gone is refused.
      const third = await makeUser('hthird');
      await api('POST', `/api/waves/${waveId}/participants`, { token: owner.token, body: { userId: third.id } });
      await acceptAll(third);
      await api('POST', `/api/waves/${waveId}/key/distribute`, { token: member.token, body: { userId: third.id, encryptedWaveKey: wrapped(), senderPublicKey: member.publicKey } });
      const thirdAsk = await api('POST', `/api/waves/${waveId}/key-request`, { token: third.token });
      await api('DELETE', `/api/waves/${waveId}/participants/${third.id}`, { token: owner.token });
      r.grantToRemoved = (await api('POST', `/api/waves/${waveId}/key-grant`, {
        token: member.token, body: { requestId: thirdAsk.body?.requestId, senderPublicKey: member.publicKey, keys: [{ keyVersion: 1, encryptedWaveKey: wrapped() }] },
      })).body?.code;
      r.removedHolds = held(third.id).map(k => k.v);
    }
    return r;
  } finally {
    if (child) child.kill('SIGKILL');
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

test('a newcomer is given the older versions of the key, safely', { timeout: 120000 }, async () => {
  const r = await scenario({ fixed: true });
  assert.deepEqual(r.newcomerBefore, [2], 'joined holding only the current key');
  assert.deepEqual(r.ask, { status: 200, versions: [1] }, 'asks for exactly what it lacks');
  assert.equal(r.outsiderAsks, 403);
  assert.deepEqual(r.grant, { status: 200, stored: 1 }, 'version 1 stored; their own 2 kept; 7 nobody holds ignored');
  assert.deepEqual(r.newcomerAfter, [1, 2]);
  assert.equal(r.v2Kept, true, 'a grant never replaces a key someone holds');
  assert.equal(r.wrongSender, 'SENDER_KEY_MISMATCH');
  assert.equal(r.askAgain, 400, 'nothing left to ask for');
  assert.deepEqual(r.allKeys, [1, 2], 'the device can now unwrap both');
  assert.equal(r.grantToRemoved, 'NOT_A_MEMBER');
  assert.deepEqual(r.removedHolds, [2], 'removed before the grant: given nothing more');
});

test('counterfactual: with the old request rule the newcomer cannot even ask', { timeout: 120000 }, async () => {
  const r = await scenario({ fixed: false });
  assert.deepEqual(r.newcomerBefore, [2]);
  assert.equal(r.ask.status, 400, 'holding the current key ended the request');
});
